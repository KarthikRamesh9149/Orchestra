DO $$
BEGIN
  ALTER TYPE "ArtifactType" ADD VALUE 'live_doc';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TYPE "SocratesPageContext" ADD VALUE 'live_doc';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TYPE "SocratesSelectedRefType" ADD VALUE 'live_doc_section';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TYPE "SocratesCitationType" ADD VALUE 'live_doc_section';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TYPE "SocratesOpenTargetType" ADD VALUE 'live_doc_section';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TYPE "LiveDocDraftStatus" AS ENUM (
  'draft',
  'needs_review',
  'accepted',
  'rejected',
  'superseded',
  'withdrawn'
);

CREATE TYPE "LiveDocCommentType" AS ENUM ('review', 'system');

CREATE TYPE "LiveDocRevisionEventType" AS ENUM (
  'draft_created',
  'draft_updated',
  'proposal_created',
  'proposal_accepted',
  'proposal_rejected',
  'published_refresh'
);

CREATE TABLE "live_doc_section_drafts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "project_id" UUID NOT NULL,
  "artifact_version_id" UUID NOT NULL,
  "section_key" TEXT NOT NULL,
  "section_label" TEXT NOT NULL,
  "base_content" TEXT NOT NULL,
  "proposed_content" TEXT NOT NULL,
  "status" "LiveDocDraftStatus" NOT NULL,
  "created_by" UUID NOT NULL,
  "linked_proposal_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "live_doc_section_drafts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "live_doc_comments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "project_id" UUID NOT NULL,
  "section_key" TEXT NOT NULL,
  "draft_id" UUID,
  "comment_type" "LiveDocCommentType" NOT NULL,
  "body_text" TEXT NOT NULL,
  "author_user_id" UUID,
  "source_label" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "live_doc_comments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "live_doc_section_revisions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "project_id" UUID NOT NULL,
  "section_key" TEXT NOT NULL,
  "artifact_version_id" UUID,
  "draft_id" UUID,
  "proposal_id" UUID,
  "actor_user_id" UUID,
  "event_type" "LiveDocRevisionEventType" NOT NULL,
  "previous_content" TEXT,
  "next_content" TEXT,
  "change_summary" TEXT,
  "event_key" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "live_doc_section_revisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "live_doc_section_drafts_project_id_section_key_key"
  ON "live_doc_section_drafts"("project_id", "section_key");

CREATE INDEX "live_doc_section_drafts_project_id_status_updated_at_idx"
  ON "live_doc_section_drafts"("project_id", "status", "updated_at" DESC);

CREATE INDEX "live_doc_section_drafts_artifact_version_id_section_key_idx"
  ON "live_doc_section_drafts"("artifact_version_id", "section_key");

CREATE INDEX "live_doc_comments_project_id_section_key_created_at_idx"
  ON "live_doc_comments"("project_id", "section_key", "created_at" DESC);

CREATE INDEX "live_doc_comments_draft_id_created_at_idx"
  ON "live_doc_comments"("draft_id", "created_at" DESC);

CREATE UNIQUE INDEX "live_doc_section_revisions_event_key_key"
  ON "live_doc_section_revisions"("event_key");

CREATE INDEX "live_doc_section_revisions_project_id_section_key_created_at_idx"
  ON "live_doc_section_revisions"("project_id", "section_key", "created_at" DESC);

CREATE INDEX "live_doc_section_revisions_proposal_id_created_at_idx"
  ON "live_doc_section_revisions"("proposal_id", "created_at" DESC);

CREATE INDEX "live_doc_section_revisions_draft_id_created_at_idx"
  ON "live_doc_section_revisions"("draft_id", "created_at" DESC);

ALTER TABLE "live_doc_section_drafts"
  ADD CONSTRAINT "live_doc_section_drafts_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "live_doc_section_drafts"
  ADD CONSTRAINT "live_doc_section_drafts_artifact_version_id_fkey"
  FOREIGN KEY ("artifact_version_id") REFERENCES "artifact_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "live_doc_section_drafts"
  ADD CONSTRAINT "live_doc_section_drafts_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "live_doc_section_drafts"
  ADD CONSTRAINT "live_doc_section_drafts_linked_proposal_id_fkey"
  FOREIGN KEY ("linked_proposal_id") REFERENCES "spec_change_proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "live_doc_comments"
  ADD CONSTRAINT "live_doc_comments_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "live_doc_comments"
  ADD CONSTRAINT "live_doc_comments_draft_id_fkey"
  FOREIGN KEY ("draft_id") REFERENCES "live_doc_section_drafts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "live_doc_comments"
  ADD CONSTRAINT "live_doc_comments_author_user_id_fkey"
  FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "live_doc_section_revisions"
  ADD CONSTRAINT "live_doc_section_revisions_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "live_doc_section_revisions"
  ADD CONSTRAINT "live_doc_section_revisions_artifact_version_id_fkey"
  FOREIGN KEY ("artifact_version_id") REFERENCES "artifact_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "live_doc_section_revisions"
  ADD CONSTRAINT "live_doc_section_revisions_draft_id_fkey"
  FOREIGN KEY ("draft_id") REFERENCES "live_doc_section_drafts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "live_doc_section_revisions"
  ADD CONSTRAINT "live_doc_section_revisions_proposal_id_fkey"
  FOREIGN KEY ("proposal_id") REFERENCES "spec_change_proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "live_doc_section_revisions"
  ADD CONSTRAINT "live_doc_section_revisions_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
