CREATE TYPE "ProjectLiveDocSourceKind" AS ENUM ('uploaded_prd', 'uploaded_srs', 'generated_prd', 'generated_srs');

CREATE TABLE "project_live_doc_sources" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "document_version_id" UUID,
    "source_kind" "ProjectLiveDocSourceKind" NOT NULL,
    "set_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "project_live_doc_sources_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_live_doc_sources_project_id_key" ON "project_live_doc_sources"("project_id");
CREATE INDEX "project_live_doc_sources_org_id_idx" ON "project_live_doc_sources"("org_id");
CREATE INDEX "project_live_doc_sources_document_id_idx" ON "project_live_doc_sources"("document_id");
CREATE INDEX "project_live_doc_sources_document_version_id_idx" ON "project_live_doc_sources"("document_version_id");
CREATE INDEX "project_live_doc_sources_source_kind_idx" ON "project_live_doc_sources"("source_kind");

ALTER TABLE "project_live_doc_sources" ADD CONSTRAINT "project_live_doc_sources_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_live_doc_sources" ADD CONSTRAINT "project_live_doc_sources_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_live_doc_sources" ADD CONSTRAINT "project_live_doc_sources_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_live_doc_sources" ADD CONSTRAINT "project_live_doc_sources_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "document_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "project_live_doc_sources" ADD CONSTRAINT "project_live_doc_sources_set_by_user_id_fkey" FOREIGN KEY ("set_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "live_doc_section_drafts" ADD COLUMN "source_document_id" UUID,
ADD COLUMN "source_document_version_id" UUID,
ADD COLUMN "document_section_id" UUID,
ADD COLUMN "anchor_id" TEXT;
ALTER TABLE "live_doc_section_drafts" ALTER COLUMN "artifact_version_id" DROP NOT NULL;

ALTER TABLE "live_doc_section_revisions" ADD COLUMN "source_document_id" UUID,
ADD COLUMN "source_document_version_id" UUID,
ADD COLUMN "document_section_id" UUID,
ADD COLUMN "anchor_id" TEXT;

CREATE INDEX "live_doc_section_drafts_project_id_document_section_id_idx" ON "live_doc_section_drafts"("project_id", "document_section_id");
CREATE INDEX "live_doc_section_revisions_project_id_document_section_id_idx" ON "live_doc_section_revisions"("project_id", "document_section_id");
