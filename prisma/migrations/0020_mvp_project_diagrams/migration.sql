CREATE TYPE "ProjectDiagramType" AS ENUM (
  'flowchart',
  'coding_flow',
  'requirement_flow',
  'system_process',
  'sequence',
  'module_dependency',
  'architecture'
);

CREATE TYPE "ProjectDiagramSource" AS ENUM ('user_created', 'socrates_generated');

CREATE TYPE "ProjectDiagramStatus" AS ENUM ('active', 'deleted');

ALTER TYPE "SocratesCitationType" ADD VALUE IF NOT EXISTS 'project_diagram';
ALTER TYPE "SocratesOpenTargetType" ADD VALUE IF NOT EXISTS 'project_diagram';
ALTER TYPE "SocratesSelectedRefType" ADD VALUE IF NOT EXISTS 'project_diagram';

CREATE TABLE "project_diagrams" (
  "id" UUID NOT NULL,
  "org_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "diagram_type" "ProjectDiagramType" NOT NULL,
  "mermaid_source" TEXT NOT NULL,
  "source" "ProjectDiagramSource" NOT NULL DEFAULT 'user_created',
  "status" "ProjectDiagramStatus" NOT NULL DEFAULT 'active',
  "linked_document_section_ids_json" JSONB NOT NULL DEFAULT '[]',
  "linked_brain_node_ids_json" JSONB NOT NULL DEFAULT '[]',
  "linked_context_entry_ids_json" JSONB NOT NULL DEFAULT '[]',
  "linked_artifact_version_id" UUID,
  "created_by_user_id" UUID NOT NULL,
  "updated_by_user_id" UUID NOT NULL,
  "deleted_at" TIMESTAMPTZ(6),
  "deleted_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "project_diagrams_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "live_doc_section_diagrams" (
  "id" UUID NOT NULL,
  "org_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "section_key" TEXT NOT NULL,
  "diagram_id" UUID NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "embedded_by_user_id" UUID NOT NULL,
  "embedded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "live_doc_section_diagrams_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "project_diagrams_org_id_idx" ON "project_diagrams"("org_id");
CREATE INDEX "project_diagrams_project_id_status_idx" ON "project_diagrams"("project_id", "status");
CREATE INDEX "project_diagrams_project_id_diagram_type_idx" ON "project_diagrams"("project_id", "diagram_type");
CREATE INDEX "project_diagrams_project_id_source_idx" ON "project_diagrams"("project_id", "source");
CREATE INDEX "project_diagrams_project_id_created_at_idx" ON "project_diagrams"("project_id", "created_at");

CREATE UNIQUE INDEX "live_doc_section_diagrams_project_id_section_key_diagram_id_key"
  ON "live_doc_section_diagrams"("project_id", "section_key", "diagram_id");
CREATE INDEX "live_doc_section_diagrams_project_id_section_key_idx"
  ON "live_doc_section_diagrams"("project_id", "section_key");
CREATE INDEX "live_doc_section_diagrams_diagram_id_idx"
  ON "live_doc_section_diagrams"("diagram_id");

ALTER TABLE "project_diagrams"
  ADD CONSTRAINT "project_diagrams_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "project_diagrams_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "project_diagrams_linked_artifact_version_id_fkey"
  FOREIGN KEY ("linked_artifact_version_id") REFERENCES "artifact_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "project_diagrams_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "project_diagrams_updated_by_user_id_fkey"
  FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "project_diagrams_deleted_by_user_id_fkey"
  FOREIGN KEY ("deleted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "live_doc_section_diagrams"
  ADD CONSTRAINT "live_doc_section_diagrams_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "live_doc_section_diagrams_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "live_doc_section_diagrams_diagram_id_fkey"
  FOREIGN KEY ("diagram_id") REFERENCES "project_diagrams"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "live_doc_section_diagrams_embedded_by_user_id_fkey"
  FOREIGN KEY ("embedded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
