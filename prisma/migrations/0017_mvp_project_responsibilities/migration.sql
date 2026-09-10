CREATE TYPE "ProjectResponsibilityArea" AS ENUM (
  'frontend',
  'backend',
  'api',
  'ai',
  'design',
  'qa',
  'docs',
  'devops',
  'product',
  'other'
);

CREATE TYPE "ProjectResponsibilityStatus" AS ENUM (
  'open',
  'in_progress',
  'done',
  'blocked'
);

CREATE TYPE "ProjectResponsibilitySource" AS ENUM (
  'manual',
  'socrates'
);

ALTER TYPE "SocratesCitationType" ADD VALUE 'project_responsibility';
ALTER TYPE "SocratesOpenTargetType" ADD VALUE 'project_responsibility';

CREATE TABLE "project_responsibilities" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "member_id" UUID,
  "assignee_name" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "area" "ProjectResponsibilityArea" NOT NULL,
  "status" "ProjectResponsibilityStatus" NOT NULL DEFAULT 'open',
  "source" "ProjectResponsibilitySource" NOT NULL DEFAULT 'manual',
  "created_by_user_id" UUID NOT NULL,
  "updated_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "project_responsibilities_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "project_responsibilities_org_id_idx" ON "project_responsibilities"("org_id");
CREATE INDEX "project_responsibilities_project_id_status_idx" ON "project_responsibilities"("project_id", "status");
CREATE INDEX "project_responsibilities_project_id_area_idx" ON "project_responsibilities"("project_id", "area");
CREATE INDEX "project_responsibilities_project_id_member_id_idx" ON "project_responsibilities"("project_id", "member_id");
CREATE INDEX "project_responsibilities_project_id_created_at_idx" ON "project_responsibilities"("project_id", "created_at");

ALTER TABLE "project_responsibilities"
  ADD CONSTRAINT "project_responsibilities_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_responsibilities"
  ADD CONSTRAINT "project_responsibilities_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_responsibilities"
  ADD CONSTRAINT "project_responsibilities_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "project_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "project_responsibilities"
  ADD CONSTRAINT "project_responsibilities_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_responsibilities"
  ADD CONSTRAINT "project_responsibilities_updated_by_user_id_fkey"
  FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
