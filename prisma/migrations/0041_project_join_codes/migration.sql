CREATE TABLE "project_join_codes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "project_id" UUID NOT NULL,
  "org_id" UUID NOT NULL,
  "code_hash" TEXT NOT NULL,
  "code_prefix" TEXT NOT NULL,
  "project_role" "ProjectRole" NOT NULL DEFAULT 'dev',
  "max_uses" INTEGER NOT NULL DEFAULT 1,
  "use_count" INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "revoked_at" TIMESTAMPTZ(6),
  "revoked_by" UUID,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "project_join_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_join_codes_code_hash_key" ON "project_join_codes"("code_hash");
CREATE INDEX "project_join_codes_project_id_revoked_at_idx" ON "project_join_codes"("project_id", "revoked_at");
CREATE INDEX "project_join_codes_org_id_expires_at_idx" ON "project_join_codes"("org_id", "expires_at");
CREATE INDEX "project_join_codes_code_prefix_idx" ON "project_join_codes"("code_prefix");

ALTER TABLE "project_join_codes" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "project_join_codes" ADD CONSTRAINT "project_join_codes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_join_codes" ADD CONSTRAINT "project_join_codes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_join_codes" ADD CONSTRAINT "project_join_codes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
