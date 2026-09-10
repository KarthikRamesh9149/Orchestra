CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "GlobalRole" AS ENUM ('owner', 'admin', 'member');

-- CreateEnum
CREATE TYPE "WorkspaceRoleDefault" AS ENUM ('manager', 'dev', 'client');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('active', 'paused', 'archived');

-- CreateEnum
CREATE TYPE "ProjectRole" AS ENUM ('manager', 'dev', 'client');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('prd', 'srs', 'meeting_note', 'call_note', 'reference', 'internal_note', 'other');

-- CreateEnum
CREATE TYPE "DocumentVisibility" AS ENUM ('internal', 'shared_with_client');

-- CreateEnum
CREATE TYPE "DocumentVersionStatus" AS ENUM ('pending', 'processing', 'ready', 'partial', 'failed');

-- CreateEnum
CREATE TYPE "ArtifactType" AS ENUM ('source_package', 'clarified_brief', 'brain_graph', 'product_brain');

-- CreateEnum
CREATE TYPE "ArtifactStatus" AS ENUM ('draft', 'accepted', 'superseded', 'failed');

-- CreateEnum
CREATE TYPE "BrainNodeType" AS ENUM ('module', 'flow', 'constraint', 'integration', 'decision', 'unknown', 'source_cluster');

-- CreateEnum
CREATE TYPE "BrainNodeStatus" AS ENUM ('active', 'unresolved', 'changed', 'deprecated');

-- CreateEnum
CREATE TYPE "BrainNodePriority" AS ENUM ('high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "BrainEdgeType" AS ENUM ('depends_on', 'relates_to', 'changed_by', 'supported_by', 'references');

-- CreateEnum
CREATE TYPE "BrainSectionRelationship" AS ENUM ('supports', 'defines', 'changes', 'clarifies', 'contradicts');

-- CreateEnum
CREATE TYPE "ProposalType" AS ENUM ('requirement_change', 'decision_change', 'clarification', 'contradiction_resolution');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('detected', 'needs_review', 'accepted', 'rejected', 'superseded');

-- CreateEnum
CREATE TYPE "ChangeLinkType" AS ENUM ('message', 'thread', 'document_section', 'brain_node');

-- CreateEnum
CREATE TYPE "ChangeRelationship" AS ENUM ('source', 'affected', 'evidence');

-- CreateEnum
CREATE TYPE "DecisionStatus" AS ENUM ('open', 'accepted', 'rejected', 'superseded');

-- CreateEnum
CREATE TYPE "CommunicationMessageType" AS ENUM ('user', 'system', 'bot', 'file_share', 'note', 'other');

-- CreateEnum
CREATE TYPE "JobRunStatus" AS ENUM ('pending', 'running', 'completed', 'failed', 'dead');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "display_name" TEXT NOT NULL,
    "job_title" TEXT,
    "global_role" "GlobalRole" NOT NULL,
    "workspace_role_default" "WorkspaceRoleDefault" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProjectStatus" NOT NULL,
    "preview_url" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_members" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "project_role" "ProjectRole" NOT NULL,
    "role_in_project" TEXT,
    "allocation_percent" INTEGER,
    "weekly_capacity_hours" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "title" TEXT NOT NULL,
    "current_version_id" UUID,
    "uploaded_by" UUID NOT NULL,
    "visibility" "DocumentVisibility" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "file_key" TEXT NOT NULL,
    "checksum_sha256" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size" BIGINT NOT NULL,
    "status" "DocumentVersionStatus" NOT NULL,
    "parse_revision" INTEGER NOT NULL DEFAULT 1,
    "parse_confidence" DECIMAL(4,3),
    "source_label" TEXT,
    "parse_warning_json" JSONB,
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_sections" (
    "id" UUID NOT NULL,
    "document_version_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "parse_revision" INTEGER NOT NULL DEFAULT 1,
    "section_key" TEXT NOT NULL,
    "heading_path" TEXT[],
    "page_number" INTEGER,
    "page_start" INTEGER,
    "page_end" INTEGER,
    "anchor_id" TEXT NOT NULL,
    "anchor_text" TEXT,
    "normalized_text" TEXT NOT NULL,
    "char_start" INTEGER,
    "char_end" INTEGER,
    "order_index" INTEGER NOT NULL,
    "metadata_json" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_chunks" (
    "id" UUID NOT NULL,
    "document_version_id" UUID NOT NULL,
    "section_id" UUID,
    "project_id" UUID NOT NULL,
    "parse_revision" INTEGER NOT NULL DEFAULT 1,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "contextual_content" TEXT,
    "lexical_content" TEXT NOT NULL,
    "embedding" vector(1536),
    "token_count" INTEGER NOT NULL,
    "page_number" INTEGER,
    "metadata_json" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artifact_versions" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "artifact_type" "ArtifactType" NOT NULL,
    "version_number" INTEGER NOT NULL,
    "parent_version_id" UUID,
    "status" "ArtifactStatus" NOT NULL,
    "source_refs_json" JSONB,
    "payload_json" JSONB NOT NULL,
    "change_summary" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMPTZ(6),

    CONSTRAINT "artifact_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brain_nodes" (
    "id" UUID NOT NULL,
    "artifact_version_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "node_key" TEXT NOT NULL,
    "node_type" "BrainNodeType" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "status" "BrainNodeStatus" NOT NULL,
    "priority" "BrainNodePriority",
    "metadata_json" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brain_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brain_edges" (
    "id" UUID NOT NULL,
    "artifact_version_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "from_node_id" UUID NOT NULL,
    "to_node_id" UUID NOT NULL,
    "edge_type" "BrainEdgeType" NOT NULL,
    "weight" DECIMAL(5,2),
    "metadata_json" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brain_edges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brain_section_links" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "artifact_version_id" UUID NOT NULL,
    "brain_node_id" UUID NOT NULL,
    "document_section_id" UUID NOT NULL,
    "relationship" "BrainSectionRelationship" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brain_section_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spec_change_proposals" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "proposal_type" "ProposalType" NOT NULL,
    "status" "ProposalStatus" NOT NULL,
    "source_message_count" INTEGER NOT NULL DEFAULT 0,
    "old_understanding_json" JSONB,
    "new_understanding_json" JSONB,
    "impact_summary_json" JSONB,
    "external_evidence_refs_json" JSONB,
    "accepted_brain_version_id" UUID,
    "decision_record_id" UUID,
    "accepted_by" UUID,
    "accepted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "spec_change_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spec_change_links" (
    "id" UUID NOT NULL,
    "spec_change_proposal_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "link_type" "ChangeLinkType" NOT NULL,
    "link_ref_id" TEXT NOT NULL,
    "relationship" "ChangeRelationship" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spec_change_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_records" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "status" "DecisionStatus" NOT NULL,
    "source_summary" TEXT,
    "accepted_by" UUID,
    "accepted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "decision_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_threads" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "provider_thread_id" TEXT NOT NULL,
    "subject" TEXT,
    "participants_json" JSONB NOT NULL,
    "started_at" TIMESTAMPTZ(6),
    "last_message_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "communication_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_messages" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "provider_message_id" TEXT NOT NULL,
    "sender_label" TEXT NOT NULL,
    "sender_external_ref" TEXT,
    "sent_at" TIMESTAMPTZ(6) NOT NULL,
    "body_text" TEXT NOT NULL,
    "body_html" TEXT,
    "message_type" "CommunicationMessageType" NOT NULL,
    "reply_to_message_id" UUID,
    "raw_metadata_json" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communication_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "project_id" UUID,
    "org_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "event_type" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "payload_json" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_runs" (
    "id" UUID NOT NULL,
    "job_type" TEXT NOT NULL,
    "status" "JobRunStatus" NOT NULL,
    "idempotency_key" TEXT,
    "payload_json" JSONB,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "scheduled_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_org_id_email_key" ON "users"("org_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "projects_org_id_slug_key" ON "projects"("org_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "project_members_project_id_user_id_key" ON "project_members"("project_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_document_id_checksum_sha256_key" ON "document_versions"("document_id", "checksum_sha256");

-- CreateIndex
CREATE UNIQUE INDEX "doc_sections_version_revision_anchor_key" ON "document_sections"("document_version_id", "parse_revision", "anchor_id");

-- CreateIndex
CREATE UNIQUE INDEX "doc_sections_version_revision_section_key" ON "document_sections"("document_version_id", "parse_revision", "section_key");

-- CreateIndex
CREATE UNIQUE INDEX "doc_chunks_version_revision_chunk_key" ON "document_chunks"("document_version_id", "parse_revision", "chunk_index");

-- CreateIndex
CREATE UNIQUE INDEX "artifact_versions_project_id_artifact_type_version_number_key" ON "artifact_versions"("project_id", "artifact_type", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "brain_nodes_artifact_version_id_node_key_key" ON "brain_nodes"("artifact_version_id", "node_key");

-- CreateIndex
CREATE UNIQUE INDEX "brain_edges_artifact_version_id_from_node_id_to_node_id_edg_key" ON "brain_edges"("artifact_version_id", "from_node_id", "to_node_id", "edge_type");

-- CreateIndex
CREATE UNIQUE INDEX "brain_section_links_unique_key" ON "brain_section_links"("artifact_version_id", "brain_node_id", "document_section_id", "relationship");

-- CreateIndex
CREATE UNIQUE INDEX "communication_threads_project_id_provider_thread_id_key" ON "communication_threads"("project_id", "provider_thread_id");

-- CreateIndex
CREATE UNIQUE INDEX "communication_messages_thread_id_provider_message_id_key" ON "communication_messages"("thread_id", "provider_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "spec_change_links_unique_key" ON "spec_change_links"("spec_change_proposal_id", "link_type", "link_ref_id", "relationship");

-- CreateIndex
CREATE UNIQUE INDEX "job_runs_idempotency_key_key" ON "job_runs"("idempotency_key");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_sections" ADD CONSTRAINT "document_sections_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "document_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_sections" ADD CONSTRAINT "document_sections_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "document_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "document_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_parent_version_id_fkey" FOREIGN KEY ("parent_version_id") REFERENCES "artifact_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brain_nodes" ADD CONSTRAINT "brain_nodes_artifact_version_id_fkey" FOREIGN KEY ("artifact_version_id") REFERENCES "artifact_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brain_nodes" ADD CONSTRAINT "brain_nodes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brain_edges" ADD CONSTRAINT "brain_edges_artifact_version_id_fkey" FOREIGN KEY ("artifact_version_id") REFERENCES "artifact_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brain_edges" ADD CONSTRAINT "brain_edges_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brain_edges" ADD CONSTRAINT "brain_edges_from_node_id_fkey" FOREIGN KEY ("from_node_id") REFERENCES "brain_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brain_edges" ADD CONSTRAINT "brain_edges_to_node_id_fkey" FOREIGN KEY ("to_node_id") REFERENCES "brain_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brain_section_links" ADD CONSTRAINT "brain_section_links_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brain_section_links" ADD CONSTRAINT "brain_section_links_artifact_version_id_fkey" FOREIGN KEY ("artifact_version_id") REFERENCES "artifact_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brain_section_links" ADD CONSTRAINT "brain_section_links_brain_node_id_fkey" FOREIGN KEY ("brain_node_id") REFERENCES "brain_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brain_section_links" ADD CONSTRAINT "brain_section_links_document_section_id_fkey" FOREIGN KEY ("document_section_id") REFERENCES "document_sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spec_change_proposals" ADD CONSTRAINT "spec_change_proposals_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spec_change_proposals" ADD CONSTRAINT "spec_change_proposals_accepted_brain_version_id_fkey" FOREIGN KEY ("accepted_brain_version_id") REFERENCES "artifact_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spec_change_proposals" ADD CONSTRAINT "spec_change_proposals_decision_record_id_fkey" FOREIGN KEY ("decision_record_id") REFERENCES "decision_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spec_change_proposals" ADD CONSTRAINT "spec_change_proposals_accepted_by_fkey" FOREIGN KEY ("accepted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spec_change_links" ADD CONSTRAINT "spec_change_links_spec_change_proposal_id_fkey" FOREIGN KEY ("spec_change_proposal_id") REFERENCES "spec_change_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spec_change_links" ADD CONSTRAINT "spec_change_links_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_records" ADD CONSTRAINT "decision_records_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_records" ADD CONSTRAINT "decision_records_accepted_by_fkey" FOREIGN KEY ("accepted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_threads" ADD CONSTRAINT "communication_threads_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_messages" ADD CONSTRAINT "communication_messages_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_messages" ADD CONSTRAINT "communication_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "communication_threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_messages" ADD CONSTRAINT "communication_messages_reply_to_message_id_fkey" FOREIGN KEY ("reply_to_message_id") REFERENCES "communication_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Retrieval and read-model indexes
CREATE INDEX "document_versions_project_id_status_parse_revision_idx" ON "document_versions"("project_id", "status", "parse_revision");
CREATE INDEX "doc_sections_version_revision_order_idx" ON "document_sections"("document_version_id", "parse_revision", "order_index");
CREATE INDEX "document_chunks_project_id_document_version_id_idx" ON "document_chunks"("project_id", "document_version_id");
CREATE INDEX "doc_chunks_version_revision_chunk_idx" ON "document_chunks"("document_version_id", "parse_revision", "chunk_index");
CREATE INDEX "document_chunks_section_id_idx" ON "document_chunks"("section_id");
CREATE INDEX "artifact_versions_project_id_artifact_type_status_created_at_idx" ON "artifact_versions"("project_id", "artifact_type", "status", "created_at");
CREATE UNIQUE INDEX "artifact_versions_single_accepted_idx" ON "artifact_versions"("project_id", "artifact_type") WHERE "status" = 'accepted';
CREATE INDEX "spec_change_links_project_id_link_type_link_ref_id_idx" ON "spec_change_links"("project_id", "link_type", "link_ref_id");
CREATE INDEX "communication_messages_project_id_sent_at_idx" ON "communication_messages"("project_id", "sent_at");
CREATE INDEX "document_chunks_embedding_idx" ON "document_chunks" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);
CREATE INDEX "document_chunks_lexical_content_idx" ON "document_chunks" USING GIN (to_tsvector('english', "lexical_content"));

