ALTER TYPE "ArtifactType" ADD VALUE IF NOT EXISTS 'engineering_requirements';
ALTER TYPE "SocratesPageContext" ADD VALUE IF NOT EXISTS 'coding_requirements';
ALTER TYPE "SocratesSelectedRefType" ADD VALUE IF NOT EXISTS 'coding_requirements';
ALTER TYPE "SocratesCitationType" ADD VALUE IF NOT EXISTS 'coding_requirements';
ALTER TYPE "SocratesOpenTargetType" ADD VALUE IF NOT EXISTS 'coding_requirements';

CREATE TABLE "project_coding_requirements" (
  "id" UUID NOT NULL,
  "org_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "artifact_version_id" UUID NOT NULL,
  "mermaid_diagram_id" UUID,
  "generated_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "project_coding_requirements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "project_coding_requirements_org_id_idx" ON "project_coding_requirements"("org_id");
CREATE INDEX "project_coding_requirements_project_id_created_at_idx" ON "project_coding_requirements"("project_id", "created_at");
CREATE INDEX "project_coding_requirements_project_id_artifact_version_id_idx" ON "project_coding_requirements"("project_id", "artifact_version_id");
CREATE INDEX "project_coding_requirements_project_id_mermaid_diagram_id_idx" ON "project_coding_requirements"("project_id", "mermaid_diagram_id");

ALTER TABLE "project_coding_requirements"
  ADD CONSTRAINT "project_coding_requirements_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "project_coding_requirements_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "project_coding_requirements_artifact_version_id_fkey"
  FOREIGN KEY ("artifact_version_id") REFERENCES "artifact_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "project_coding_requirements_mermaid_diagram_id_fkey"
  FOREIGN KEY ("mermaid_diagram_id") REFERENCES "project_diagrams"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "project_coding_requirements_generated_by_user_id_fkey"
  FOREIGN KEY ("generated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
